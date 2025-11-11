/**
 * Mock File System for Testing
 * Simulates file operations without touching actual disk
 */

class MockFileSystem {
  constructor() {
    this.files = new Map();
    this.directories = new Set(['transcriptions', 'prompts', 'agents']);
  }

  // Read file
  async readFile(path, encoding = 'utf-8') {
    if (!this.files.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    return this.files.get(path);
  }

  // Write file
  async writeFile(path, content, encoding = 'utf-8') {
    this.files.set(path, content);
  }

  // Read directory
  async readdir(path) {
    const prefix = path.endsWith('/') ? path : path + '/';
    const filesInDir = [];

    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relativePath = filePath.substring(prefix.length);
        const fileName = relativePath.split('/')[0];
        if (!filesInDir.includes(fileName)) {
          filesInDir.push(fileName);
        }
      }
    }

    return filesInDir;
  }

  // Check if file exists
  async access(path) {
    if (!this.files.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, access '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
  }

  // Make directory
  async mkdir(path, options = {}) {
    this.directories.add(path);
  }

  // Unlink (delete) file
  async unlink(path) {
    if (!this.files.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    this.files.delete(path);
  }

  // Get file stats
  async stat(path) {
    if (!this.files.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }

    const content = this.files.get(path);
    return {
      isFile: () => true,
      isDirectory: () => false,
      size: content.length,
      mtime: new Date(),
      ctime: new Date()
    };
  }

  // Seed with test files
  seed(files) {
    for (const [path, content] of Object.entries(files)) {
      this.files.set(path, content);
    }
  }

  // Reset the file system
  reset() {
    this.files.clear();
    this.directories.clear();
    this.directories.add('transcriptions');
    this.directories.add('prompts');
    this.directories.add('agents');
  }

  // Get all files
  getAllFiles() {
    return Array.from(this.files.keys());
  }

  // Check if file exists (sync version)
  has(path) {
    return this.files.has(path);
  }
}

module.exports = { MockFileSystem };
