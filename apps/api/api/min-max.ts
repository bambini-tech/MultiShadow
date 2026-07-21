import { handleMinMax } from '../lib/handlers.js';
import { createVercelHandler } from '../lib/vercel.js';

export default createVercelHandler('GET', handleMinMax);
