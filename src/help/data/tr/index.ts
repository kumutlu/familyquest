import type { HelpArticle } from '../../types';
import basics from './basics';
import roles from './roles';
import daily from './daily';
import money from './money';
import family from './family';
import account from './account';
import support from './support';

/** Türkçe makale seti. Sıralama İngilizce setiyle birebir aynıdır. */
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
