async function fetchMergeGroupMembers(owner, repo, baseRef, headSha, token) {
  let retries = 3;
  while (retries) {
    try {
      // existing implementation
      return response;
    } catch (error) {
      if (--retries === 0) throw error;
      await new Promise(r => setTimeout(r, Math.pow(2, 3 - retries) * 1000));
    }
  }
}