import { createCipher, createDecipher, randomBytes } from 'crypto';
import { copyFileSync } from 'fs';

class AntiForensicsManager {
  private sensitive_data: Uint8Array = new Uint8Array(0);
  private encryption_key: Uint8Array = new Uint8Array(0);

  constructor(sensitive_data: string) {
    this.sensitive_data = new TextEncoder().encode(sensitive_data);
    this.encryption_key = randomBytes(32);
  }

  obscure_sensitive_data() {
    const random_bytes_array = new Uint8Array(this.sensitive_data.length);
    crypto.getRandomValues(random_bytes_array);

    for (let i = 0; i < this.sensitive_data.length; i++) {
      this.sensitive_data[i] ^= random_bytes_array[i];
    }
  }

  encrypt_sensitive_data() {
    const xor_key = randomBytes(32);
    for (let i = 0; i < this.sensitive_data.length; i++) {
      this.sensitive_data[i] ^= xor_key[i % xor_key.length];
    }

    const cipher = createCipher('aes-256-cbc', this.encryption_key);
    const encrypted_data = cipher.update(this.sensitive_data);
    this.sensitive_data = new Uint8Array(encrypted_data);
  }

  decrypt_sensitive_data(): string {
    const decipher = createDecipher('aes-256-cbc', this.encryption_key);
    const decrypted_data = decipher.update(this.sensitive_data);

    const xor_key = randomBytes(32); // XOR key
    const decrypted_array = new Uint8Array(decrypted_data.length);
    for (let i = 0; i < decrypted_data.length; i++) {
      decrypted_array[i] = decrypted_data.toString('ascii').charCodeAt(i) ^ xor_key[i % xor_key.length];
    }

    return new TextDecoder().decode(decrypted_array);
  }

  copy_sensitive_files() {
    const copy_sources = [
      {
        src: 'path/to/sensitive/source/file1.js',
        dest: 'path/to/destination/file1.js'
      },
      {
        src: 'path/to/sensitive/source/file2.js',
        dest: 'path/to/destination/file2.js'
      }
    ];

    for (const { src, dest } of copy_sources) {
      copyFileSync(src, dest);
      console.log(`Copying ${src} to ${dest}`);
    }
  }

  clear_sensitive_data() {
    crypto.getRandomValues(this.sensitive_data);
    crypto.getRandomValues(this.encryption_key);
  }
}

const manager = new AntiForensicsManager('data_to_send');

manager.obscure_sensitive_data();
manager.encrypt_sensitive_data();
manager.copy_sensitive_files();

console.log('Decrypted data:', manager.decrypt_sensitive_data());

manager.clear_sensitive_data();
