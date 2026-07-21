import { handleMinMax } from '../../lib/handlers.js';
import { createNetlifyHandler } from '../../lib/netlify.js';

export default createNetlifyHandler('GET', handleMinMax);
export const config = { path: '/api/min-max' };
