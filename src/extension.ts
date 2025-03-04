// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

// === CONSTANTS ===

let newLine: string = '\n';  // default to eol === 1
let editor = vscode.window.activeTextEditor;
if (editor !== undefined) {
	let eol = editor.document.eol;
	if (eol === 2) {
		newLine = '\r\n';
	}
}

let terminalPrefix = 'IPython';  // for the name of the terminal window.

// === FUNCTIONS ===
async function activatePython() {
	let pyExtension = vscode.extensions.getExtension('ms-python.python');
	if (pyExtension === undefined) {
		console.error('Failed to get MS-Python Extension');
		return;
	}
	await pyExtension.activate();
}

function moveAndRevealCursor(line: number, editor: vscode.TextEditor) {
	let position = editor.selection.start.with(line, 0);
	let cursor = new vscode.Selection(position, position);
	editor.selection = cursor;
	editor.revealRange(cursor.with(), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function wait(msec: number) {
	return new Promise(resolve => setTimeout(resolve, msec));
}

// === MAIN ===
export function activate(context: vscode.ExtensionContext) {
	// Activation of this extension
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// These line of code will only be executed once when extension is activated

	// Always make sure Python is available for use FIRST
	activatePython();


	// Configuration handling
	let cellPattern: RegExp;
	let uniqueTerminals: boolean;
	let delayBeforeTerminalCreationMsec: number;
	let delayAfterTerminalCreationMsec: number;
	let execDelayPerLine: number;
	let launchArgs: string;
	let startupCmds: string[];
	let runWholeFileByMagicCommand: boolean;
	let tryResolvingRelativeImport: boolean;
	function updateConfig() {
		console.log('Updating configuration...');
		let config = vscode.workspace.getConfiguration('ipython');
		let cellFlag = config.get('cellTag') as string;
		cellPattern = new RegExp(`^(?:${cellFlag.replace(' ', '\\s*')})`);
		uniqueTerminals = config.get('oneTerminalPerFile') as boolean;
		delayBeforeTerminalCreationMsec = config.get('delays.delayBeforeTerminalCreationMilliseconds') as number;
		delayAfterTerminalCreationMsec = config.get('delays.delayAfterTerminalCreationMilliseconds') as number;
		execDelayPerLine = config.get('delays.executionDelayPerLineMilliseconds') as number;
		launchArgs = config.get('launchArguments') as string;
		startupCmds = config.get('startupCommands') as string[];
		runWholeFileByMagicCommand = config.get('runWholeFileByMagicCommand') as boolean;
		tryResolvingRelativeImport = config.get('tryResolvingRelativeImport') as boolean;
	}

	let timeout: NodeJS.Timer | undefined = undefined;
	const cellHeaderDecorationType = vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: `1px 0 0 0`,
		borderStyle: 'solid'
	});
	let activeEditor = vscode.window.activeTextEditor;

	function updateDecorations() {
		if (!activeEditor) {
			return;
		}
		let config = vscode.workspace.getConfiguration('ipython');
		let cellFlag = config.get('cellTag') as string;
		const cellPatternForHeaderDetection = new RegExp(cellFlag.replace(' ', '\\s*'), 'g');

		const text = activeEditor.document.getText();
		const cellHeaders: vscode.DecorationOptions[] = [];
		let match;
		while ((match = cellPatternForHeaderDetection.exec(text))) {
			const startPos = activeEditor.document.positionAt(match.index);
			const endPos = activeEditor.document.positionAt(match.index + match[0].length);
			const decoration = { range: new vscode.Range(startPos, endPos), hoverMessage: 'Number **' + match[0] + '**' };
			cellHeaders.push(decoration);
		}
		activeEditor.setDecorations(cellHeaderDecorationType, cellHeaders);
	}

	function triggerUpdateDecorations(throttle = false) {
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		if (throttle) {
			timeout = setTimeout(updateDecorations, 500);
		} else {
			updateDecorations();
		}
	}

	if (activeEditor) {
		triggerUpdateDecorations();
	}

	vscode.window.onDidChangeActiveTextEditor(editor => {
		activeEditor = editor;
		if (editor) {
			triggerUpdateDecorations();
		}
	}, null, context.subscriptions);

	vscode.workspace.onDidChangeTextDocument(event => {
		if (event.contentChanges.length === 0) {
			return;
		}
		if (activeEditor && event.document === activeEditor.document) {
			triggerUpdateDecorations(true);
		}
	}, null, context.subscriptions);

	// === LOCAL HELPERS ===
	async function execute(terminal: vscode.Terminal, cmd: string) {
		// In the original repository, a noticeable delay is intentionally mixed to make sure completing sendText.
		// In current design, I modified sending text line-by-line, so that every line is expected to be sent promptly.
		// I therefore removed such delay. Only trivial delay is kept just in case.

		if (cmd.length === 0) {
			return;
		}

		// let [dotPath, doubleDotPath]: [string | undefined, string | undefined] = [undefined, undefined];
		let pathFromWorkspace: string[] | undefined = undefined;
		if (tryResolvingRelativeImport) {
			pathFromWorkspace = derivePathFromWorkspace();
		}
		console.log(pathFromWorkspace);

		terminal.show(true);  // preserve focus
		let lines = cmd.split(newLine);
		lines = lines.filter(s => s.trim());
		console.log(lines);

		// for the single line case, just send text
		if (lines.length === 1) {
			terminal.sendText(processLine(lines[0], pathFromWorkspace), false);
			await wait(execDelayPerLine);
			terminal.sendText('', true);

		// for the multi line case
		} else {
			// send Ctrl-O to enable multiline mode
			await vscode.commands.executeCommand("workbench.action.terminal.sendSequence", { text : "\x0f" });
			for (let line of lines) {
				terminal.sendText(processLine(line, pathFromWorkspace), true);
			}
			await wait(execDelayPerLine);
			terminal.sendText('', true);
		}

		await vscode.commands.executeCommand('workbench.action.terminal.scrollToBottom');

	}

	async function createTerminal(terminalName: string): Promise<vscode.Terminal> {
		console.log('Creating IPython Terminal...');

		// -- Create and Tag IPython Terminal
		// await vscode.commands.executeCommand('workbench.action.createTerminalEditor');
		await vscode.commands.executeCommand("workbench.action.terminal.new");  // prefer normal terminal
		await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', {name : terminalName});
		console.log(`Waiting ${delayBeforeTerminalCreationMsec} before executing IPython`);
		await wait(delayBeforeTerminalCreationMsec);
		let terminal = vscode.window.activeTerminal as vscode.Terminal;

		// Launch options
		let cmd = 'ipython ';
		if (launchArgs !== undefined) {
			cmd += launchArgs;
		}

		// Startup options
		// REF: https://ipython.readthedocs.io/en/stable/config/intro.html#command-line-arguments
		let startupCmd = '';
		if (startupCmds.length > 0) {
			for (let c of startupCmds) {
				startupCmd += " --InteractiveShellApp.exec_lines=" + `'${c}'`;
			}
			cmd += startupCmd;
		}
		console.log('Startup Command: ', cmd);
		await execute(terminal, cmd);
		// See notes in `execute` regarding delays.
		console.log(`Waiting ${delayAfterTerminalCreationMsec} milliseconds after IPython launch...`);
		await wait(delayAfterTerminalCreationMsec);

		return terminal;
	}

	function makeTerminalName(terminalName: string): string {
		if (uniqueTerminals) {
			return `${terminalPrefix} - ${terminalName}`;
		}
		return terminalPrefix;
	}

	async function getTerminal(terminalName: string): Promise<vscode.Terminal> {
		let name = makeTerminalName(terminalName);
		let terminals = vscode.window.terminals;
		if (terminals.length > 0) {
			if (uniqueTerminals) {
				for (let i = terminals.length - 1; i >= 0; i--) {
					if (terminals[i].name === name) {
						return terminals[i];
					}
				}
			}
			return vscode.window.activeTerminal!;
		}
		return await createTerminal(name);
	}

	function getEditor(): vscode.TextEditor {
		let editor = vscode.window.activeTextEditor;
		if (editor === undefined) {
			throw new Error('Unable to access Active Text Editor');
		}
		if (editor.document.languageId !== 'python') {
			throw new Error(`Editor file is ${editor.document.languageId}; expected Python.`);
		}
		return editor;
	}

	function derivePathFromWorkspace(): string[] | undefined {
		// give up
		if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length !== 1) {
			return undefined;
		}

		let workspaceFolder = vscode.workspace.workspaceFolders![0].uri.path;
		let filePath = getEditor().document.uri.path;

		// check if the current document is in workspaceFolder
		if (!filePath.startsWith(workspaceFolder)) {
			return undefined;
		}

		return path.dirname(filePath).substring(workspaceFolder.length + 1).split('/'); // +1 for '/'
	}

	function absolutifyDotPath(paths: string[], level: number): string {
		if (level === 1) {
			return paths.join('.');
		}
		return paths.slice(0, -(level - 1)).join('.');
	}

	function processLine(line: string, pathFromWorkspace: string[] | undefined): string {
		const lineTrimmed = line.trimStart();
		const dotImportPattern = /^(from [\.]+[ ]{0,1})/g;
		const dotImportMatched = lineTrimmed.match(dotImportPattern);
		if (dotImportMatched) {
			const dotImport = dotImportMatched[0];
			const level = dotImport.match(/\./g)!.length;
			let lineModified = line.replace(dotImport, "from " + absolutifyDotPath(pathFromWorkspace!, level) + (dotImport.endsWith(" ") ? " " : "."));
			return lineModified;
		}
		return line;
	}

	// === COMMANDS ===
	async function cmdRunFile(resetFirst: boolean = false) {
		updateConfig();
		console.log('IPython run file...');
		let editor = getEditor();

		let terminal = await getTerminal(editor.document.fileName);
		if (resetFirst) {
			await execute(terminal, `%reset -f`);
		}
		if (runWholeFileByMagicCommand) {
			await execute(terminal, `%run ${editor.document.fileName}`);
		} else {
			await execute(terminal, editor.document.getText());
		}
	}

	async function cmdResetAndRunFile() {
		console.log('IPython reset and run file...');
		cmdRunFile(true);
	}

	// -- Run a Selected Group of Text or Lines
	async function cmdRunSelections() {
		updateConfig();
		console.log('IPython run selection...');
		let editor = getEditor();
		let terminal = await getTerminal(editor.document.fileName);
		let cmd = '';
		for (let selection of editor.selections) {
			// if selection has leading whilespaces, include them to capture correct indent
			const leadingLetters = editor.document.getText(new vscode.Selection(
				new vscode.Position(selection.start.line, 0),
				new vscode.Position(selection.start.line, selection.start.character)).with());
			if (leadingLetters.trim().length === 0) {
				selection = new vscode.Selection(
					new vscode.Position(selection.start.line, 0), selection.end
				);
			}
			cmd += editor.document.getText(selection.with());
		}
		await execute(terminal, cmd);
	}

	//-- Run a Cell
	async function cmdRunCell(goToNextCell: boolean) {
		updateConfig();
		console.log('IPython run cell...');
		let editor = getEditor();

		let startLine = editor.selection.start.line;
		let lines = editor.document.getText().split(newLine);

		// Search up from the cursor line for a cell marker.
		let cellStart = 0;
		for (let i = startLine; i >= 0; i--) {
			if (lines[i].trim().match(cellPattern)) {
				cellStart = i + 1; // code starts on line below marker
				break;
			}
		}

		// Search down for the next cell marker
		let nextCell = lines.length;
		for (let i = startLine + 1; i < lines.length; i++) {
			if (lines[i].trim().match(cellPattern)) {
				nextCell = i;
				break;
			}
		}

		let terminal = await getTerminal(editor.document.fileName);
		let endOfFile = nextCell === lines.length;
		let cellStop = nextCell;
		let startPosition = new vscode.Position(cellStart, 0);
		let stopPosition = new vscode.Position(cellStop, 0);
		let selection = new vscode.Selection(startPosition, stopPosition);
		let cmd = editor.document.getText(selection.with());
		await execute(terminal, cmd);

		if (goToNextCell && !endOfFile) {
			moveAndRevealCursor(nextCell, editor);
		}
	}

	async function cmdRunCellAndMoveToNext() {
		console.log('IPython run selection and next...');
		cmdRunCell(true);
	}

	async function runCursor(toFrom: string) {
		updateConfig();
		let editor = getEditor();

		let startPosition: vscode.Position;
		let stopPosition: vscode.Position;
		if (toFrom === 'top') {
			startPosition = new vscode.Position(0, 0);
			stopPosition = new vscode.Position(editor.selection.start.line + 1, 0);
		}else if (toFrom === 'bottom') {
			startPosition = new vscode.Position(editor.selection.start.line, 0);
			stopPosition = new vscode.Position(editor.document.lineCount, 0);
		}else{
			console.error(`Invalid option "toFrom": ${toFrom}`);
			return;
		}

		let selection = new vscode.Selection(startPosition, stopPosition);
		let cmd = editor.document.getText(selection.with());
		let terminal = await getTerminal(editor.document.fileName);
		await execute(terminal, cmd);
	}

	async function cmdRunToLine() {
		console.log('IPython: Run from Top to Line...');
		await runCursor('top');
	}

	async function cmdRunFromLine() {
		console.log('IPython: Run from Line to Bottom...');
		await runCursor('bottom');
	}

	async function cmdCreateTerminal() {
		console.log('IPython: Creating terminal...');
		updateConfig();
		await createTerminal(terminalPrefix);
	}

	// -- Register Command to Extension
	context.subscriptions.push(vscode.commands.registerCommand('ipython.createTerminal', cmdCreateTerminal));
	context.subscriptions.push(vscode.commands.registerCommand('ipython.runFile', cmdRunFile));
	context.subscriptions.push(vscode.commands.registerCommand('ipython.resetAndRunFile', cmdResetAndRunFile));
	context.subscriptions.push(vscode.commands.registerCommand('ipython.runSelections', cmdRunSelections));
	context.subscriptions.push(vscode.commands.registerCommand('ipython.runCell', cmdRunCell));
	context.subscriptions.push(vscode.commands.registerCommand('ipython.runCellAndMoveToNext', cmdRunCellAndMoveToNext));
	context.subscriptions.push(vscode.commands.registerCommand('ipython.runToLine', cmdRunToLine));
	context.subscriptions.push(vscode.commands.registerCommand('ipython.runFromLine', cmdRunFromLine));

	// -- FIXME: Keybinding `when clause`
	vscode.commands.executeCommand('setContext', 'ipython.extensionActive', true);
}

// this method is called when your extension is deactivated
export function deactivate() {}
