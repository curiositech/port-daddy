// Removed obsolete heartbeat file check
// Simplified environment variable validation
const isCanonicalRuntimeTarget = (env) => {
  const required = ['PORT_DADDY_PREFIX', 'PORT_DADDY_PID_FILE', 'PD_HOME'];
  return required.every(key => Object.hasOwn(env, key));
};