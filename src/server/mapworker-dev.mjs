// Development entry of the map worker (running from TypeScript sources): register tsx, then load the worker.
import { register } from 'tsx/esm/api';
register();
await import('./mapworker.ts');
