// Where Chrome and the server folder are, on a Mac (tests/run.sh) or on Windows. CHROME overrides the browser.
import { fileURLToPath } from 'node:url';
export const CHROME = process.env.CHROME
  || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
export const SERVER_DIR = fileURLToPath(new URL('../server', import.meta.url));
