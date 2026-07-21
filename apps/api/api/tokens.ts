import { handleTokens } from '../lib/handlers.js';
import { createVercelHandler } from '../lib/vercel.js';

export default createVercelHandler('GET', () => handleTokens());
