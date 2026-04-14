const crypto = require('crypto');
const dotenv = require('dotenv');
dotenv.config();

const ALGORITHM = 'aes-256-gcm';
const RAW_KEY = process.env.ENCRYPTION_KEY || '0000000000000000000000000000000000000000000000000000000000000000'; // 64 hex chars fallback
const ENCRYPTION_KEY = Buffer.from(RAW_KEY, 'hex');

// Ensure key is 32 bytes
if (ENCRYPTION_KEY.length !== 32) {
    console.error('[CRITICAL] ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).');
    process.exit(1);
}

module.exports = {
    encrypt: (text) => {
        if (!text) return text;
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    },

    decrypt: (text) => {
        if (!text) return text;
        try {
            const parts = text.split(':');
            if (parts.length !== 3) return text; // Probably not encrypted or old format

            const iv = Buffer.from(parts[0], 'hex');
            const authTag = Buffer.from(parts[1], 'hex');
            const encryptedText = parts[2];

            const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            console.error('[Crypto Error] Failed to decrypt value. Is ENCRYPTION_KEY correct?');
            return '';
        }
    }
};
