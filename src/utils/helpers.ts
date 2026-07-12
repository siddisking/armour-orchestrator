
import crypto from 'crypto';

/**
 * Normalizes user queries for search query hashing and vector matching.
 */
export const normalizeQuery = (query: string): string => {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Generates a SHA-256 hash of a normalized query string.
 */
export const generateQueryHash = (query: string): string => {
  return crypto.createHash('sha256').update(query).digest('hex');
};
