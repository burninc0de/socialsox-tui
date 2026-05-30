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

render(React.createElement(App, { resetConfig: cli.flags.resetConfig }));
