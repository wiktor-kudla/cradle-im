import * as fs from 'fs';

class SecureDataWipe {
  private filePath: string = '';
  private bufferSize: number = 4096;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private generateRandomBuffer(size: number): Buffer {
    const buffer = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
    return buffer;
  }

  private overwriteWithBuffer(buffer: Buffer, iterations: number) {
    const fileDescriptor = fs.openSync(this.filePath, 'r+');
    for (let i = 0; i < iterations; i++) {
      fs.writeSync(fileDescriptor, buffer, 0, buffer.length, i * buffer.length);
    }
    fs.closeSync(fileDescriptor);
  }

  overwriteWithRandomData(iterations: number) {
    const buffer = this.generateRandomBuffer(this.bufferSize);
    this.overwriteWithBuffer(buffer, iterations);
    console.log(`File at ${this.filePath} has been securely overwritten with random data.`);
  }

  overwriteWithZeroes(iterations: number) {
    const buffer = Buffer.alloc(this.bufferSize);
    this.overwriteWithBuffer(buffer, iterations);
    console.log(`File at ${this.filePath} has been securely overwritten with zeroes.`);
  }

  overwriteWithOnes(iterations: number) {
    const buffer = Buffer.alloc(this.bufferSize, 0xFF);
    this.overwriteWithBuffer(buffer, iterations);
    console.log(`File at ${this.filePath} has been securely overwritten with ones.`);
  }

  wipeFile(pattern: 'random' | 'zeroes' | 'ones', iterations: number) {
    switch (pattern) {
      case 'random':
        this.overwriteWithRandomData(iterations);
        break;
      case 'zeroes':
        this.overwriteWithZeroes(iterations);
        break;
      case 'ones':
        this.overwriteWithOnes(iterations);
        break;
      default:
        console.log('Invalid wiping pattern.');
    }
  }
}

const wipe = new SecureDataWipe('path/to/your/file.txt');
wipe.wipeFile('random', 10); // Overwrite with random data for 10 iterations
wipe.wipeFile('zeroes', 5);  // Overwrite with zeroes for 5 iterations
wipe.wipeFile('ones', 7);    // Overwrite with ones for 7 iterations