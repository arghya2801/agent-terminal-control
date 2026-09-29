import { join } from 'node:path';
import { preparePlayground, root } from './playground.mjs';
import { startDev } from './dev-host.mjs';
const env = preparePlayground(join(root, 'playground', 'config'));
startDev({ ...process.env, ...env, VITE_ATC_PLAYGROUND: '1' });
