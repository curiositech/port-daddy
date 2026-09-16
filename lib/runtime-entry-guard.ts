/** Must be the first dependency of every runtime entry, before effectful imports. */
import { assertLocalRuntimeEnabled } from './local-runtime-control.js';
assertLocalRuntimeEnabled();
