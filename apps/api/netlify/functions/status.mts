import { handleStatus } from '../../lib/handlers.js';
import { createNetlifyHandler } from '../../lib/netlify.js';

export default createNetlifyHandler('GET', handleStatus);
export const config = { path: '/api/status' };
