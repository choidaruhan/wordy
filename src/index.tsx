import { Hono } from 'hono';
import type { Env } from './types';
import { getSessionUser } from './lib/auth';
import auth from './routes/auth';
import home from './routes/home';
import decks from './routes/decks';
import review from './routes/review';
import hard from './routes/hard';
import stats from './routes/stats';
import quiz from './routes/quiz';
import settings from './routes/settings';
import legal from './routes/legal';

const app = new Hono<Env>();

app.use('*', async (c, next) => {
  c.set('user', await getSessionUser(c));
  await next();
  c.header('Cache-Control', 'no-store');
});

app.route('/', auth);
app.route('/', home);
app.route('/', decks);
app.route('/', review);
app.route('/', hard);
app.route('/', stats);
app.route('/', quiz);
app.route('/', settings);
app.route('/', legal);

app.notFound((c) => c.text('페이지를 찾을 수 없습니다.', 404));

app.onError((err, c) => {
  console.error(err);
  return c.text('서버 오류가 발생했습니다.', 500);
});

export default app;
