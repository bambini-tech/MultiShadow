import { handleExchange } from '../../lib/handlers.js';
import { createNetlifyHandler } from '../../lib/netlify.js';

export default createNetlifyHandler('POST', handleExchange);
export const config = { path: '/api/exchange' };
