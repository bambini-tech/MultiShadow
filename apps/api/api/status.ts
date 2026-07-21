import { handleStatus } from '../lib/handlers.js';
import { createVercelHandler } from '../lib/vercel.js';

export default createVercelHandler('GET', handleStatus);
