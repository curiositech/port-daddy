function validateIdentity(session) {
  if (!session.credential) {
    throw new Error('Actor-soul credential required');
  }
  // Additional validation logic
}