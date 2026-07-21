import { handleQuote } from '../../lib/handlers.js';
import { createNetlifyHandler } from '../../lib/netlify.js';

export default createNetlifyHandler('GET', handleQuote);
export const config = { path: '/api/quote' };
