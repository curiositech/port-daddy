const skillDirs = (await fs.readdir(skillsDir, { withFileTypes: true }))
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);