import type { HelpArticle } from '../../types';
import basics from './basics';
import roles from './roles';
import daily from './daily';
import money from './money';
import family from './family';
import account from './account';
import support from './support';

/**
 * English article set. The order here is the canonical article order used by
 * category pages and by the article-parity tests.
 */
const articles: HelpArticle[] = [
  ...basics,
  ...roles,
  ...daily,
  ...money,
  ...family,
  ...account,
  ...support,
];

export default articles;
