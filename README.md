# IPython

IPython enables interactively executing code snippets and monitor their results, thereby being a handy debugging environment. This VSCode extension directly transfers code from editor to an IPython terminal.

Forked from the original versions developed by
[@hoangKnLai](https://github.com/hoangKnLai/vscode-ipython)
and
[@shaperilio](https://github.com/shaperilio/vscode-ipython)


## Features
- Settings to control the startup of an IPython console
  - Console launch argument (e.g., `--matplotlib=qt5`)
  - Console start up command (e.g., `["%load_ext autoreload", %autoreload 2]`)
- Configurable cell block tag (e.g. `# %%`)
  - A separator (horizontal line) shows up at the cell block. (*1)
- Commands to run cells, code selections, up to / from line,

## Requirements

- [Microsoft Python Extension](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
- Recommend to **disable** [Microsoft Jupyter Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) (which may be enabled by default), as some features conflict. The above mentioned visual effect (*1) explicitly conflicts with the Jupyter extension. It's OK though if you don't care.


## Known Issues

- The communication between an editor and an IPython terminal is not ensured by nature. To make it robust, a heuristic delay is introduced to await successful data transfer. This design seems working pretty well in my environment. If you experience an unintentional behavior, try customizing the following parameters via settings.
  - `ipython.delays.delayBeforeTerminalCreationMilliseconds`
  - `ipython.delays.delayAfterTerminalCreationMilliseconds`
  - `ipython.delays.executionDelayPerLineMilliseconds`

- By design, an IPython terminal is launched with the option `--no-autoindent`, which means that your cursor is not going to be automatically indented when you write code directly on the IPython terminal. Note that disabling autoindent is necessary for this extension to correctly transfer code in a nested block.

## Release Notes

See [the change log](CHANGELOG.md).