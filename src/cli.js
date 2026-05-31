import meow from 'meow';
import { render } from 'ink';
import React from 'react';
import { App } from './app.jsx';

const cli = meow(
  `
Usage
  $ socialsox-tui

Options
  --reset-config  Reset saved config and credentials fallback
`,
  {
    importMeta: import.meta,
    flags: {
      resetConfig: {
        type: 'boolean',
        default: false,
      },
    },
  }
);

// Clear scrollback + screen so npm lifecycle lines do not remain above the TUI.
process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

render(React.createElement(App, { resetConfig: cli.flags.resetConfig }));
