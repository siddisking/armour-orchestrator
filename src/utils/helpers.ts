
import crypto from 'crypto';
import { TEMPORAL_KEYWORDS } from './constant';

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

/**
 * Checks if a query contains any time-sensitive/temporal keywords that should bypass caching.
 */
export const isTemporalQuery = (query: string): boolean => {
  const normalized = query.toLowerCase();
  // Match whole words to prevent false positives (e.g. matching "newt" or "currents")
  return TEMPORAL_KEYWORDS.some(keyword => {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    return regex.test(normalized);
  });
};
