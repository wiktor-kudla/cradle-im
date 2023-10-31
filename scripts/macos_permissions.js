const { execSync } = require('child_process');

if (process.platform === 'darwin') {
  try {
    execSync('yarn add node-mac-permissions');
  } catch (error) {
    console.error('Error installing node-mac-permissions:', error);
    process.exit(1);
  }
}