import { handleTokens } from '../../lib/handlers.js';
import { createNetlifyHandler } from '../../lib/netlify.js';

export default createNetlifyHandler('GET', () => handleTokens());
export const config = { path: '/api/tokens' };
