import { isAuthed, json } from './_lib/auth.js';

export default async (req) => json({ authed: isAuthed(req) });
