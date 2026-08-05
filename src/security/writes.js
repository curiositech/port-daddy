function secureWrite(data, credential) {
  if (!validateCredential(credential)) {
    return reject('Invalid lookup credential');
  }
  // Proceed with write
}