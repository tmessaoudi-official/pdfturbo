// Generates a comprehensive Arabic / multi-script test PDF by printing an HTML
// page through real Chrome (correct bidi + shaping, as a real authoring tool would).
// Output: tests/fixtures/corpus-public/arabic-allcases.pdf
// Run: node scripts/gen-arabic-fixture.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'tests', 'fixtures', 'corpus-public', 'arabic-allcases.pdf');

const html = `<!doctype html><html lang="ar"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 18mm; }
  body { font-family: 'Noto Naskh Arabic','Amiri','Arial',sans-serif; font-size: 14pt; color:#111; line-height:1.6; }
  h1 { font-size: 24pt; } h2 { font-size: 18pt; color:#1d4ed8; }
  .rtl { direction: rtl; text-align: right; }
  .ltr { direction: ltr; text-align: left; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; }
  td, th { border: 1px solid #444; padding: 6px 10px; }
  ul, ol { margin: 4px 24px; }
  .box { border:1px solid #bbb; padding:8px; margin:6px 0; }
  .small { font-size: 10pt; color:#555; }
</style></head><body>

<h1 class="rtl">مستند اختبار شامل للغة العربية</h1>
<p class="small ltr">Comprehensive Arabic / RTL test document — generated for PDFturbo QA.</p>

<h2 class="rtl">١ ـ فقرة عربية خالصة (RTL)</h2>
<p class="rtl">هذه فقرة مكتوبة بالكامل باللغة العربية لاختبار اتجاه النص من اليمين إلى اليسار،
وتشكيل الحروف المتصلة والمنفصلة، مثل: بسم الله الرحمن الرحيم. السلام عليكم ورحمة الله وبركاته.
نختبر هنا التفاف السطر عندما يصبح النص طويلاً بما يكفي ليمتد على أكثر من سطر واحد داخل الصفحة.</p>

<h2 class="rtl">٢ ـ نص مختلط عربي ولاتيني وأرقام (bidi)</h2>
<p class="rtl">المنتج اسمه PDFturbo ويعمل بنسبة 100% داخل المتصفح، بدون خادم.
البريد الإلكتروني support@example.com والإصدار رقم v2.0.0 صدر سنة 2026.</p>
<p class="ltr">Mixed line the other way: the file نظام.pdf was opened at 14:30 with success.</p>

<h2 class="rtl">٣ ـ تشكيل وحركات (diacritics / tashkeel)</h2>
<p class="rtl">مَرْحَبًا بِكُمْ فِي بَرْنَامَجِ تَحْرِيرِ المُسْتَنَدَاتِ. اللُّغَةُ العَرَبِيَّةُ جَمِيلَةٌ.</p>

<h2 class="rtl">٤ ـ قوائم مرقّمة ونقطية</h2>
<ol class="rtl"><li>العنصر الأول في القائمة</li><li>العنصر الثاني مع نص أطول قليلاً</li><li>الثالث</li></ol>
<ul class="rtl"><li>نقطة أولى</li><li>نقطة ثانية</li></ul>

<h2 class="rtl">٥ ـ جدول بالعربية (RTL table)</h2>
<table class="rtl"><thead><tr><th>الاسم</th><th>القيمة</th><th>Note</th></tr></thead>
<tbody>
<tr><td>الطول</td><td>٢١٠ مم</td><td>A4</td></tr>
<tr><td>العرض</td><td>٢٩٧ مم</td><td>portrait</td></tr>
<tr><td>الصفحات</td><td>1</td><td>single</td></tr>
</tbody></table>

<h2 class="ltr">6 — Pure Latin paragraph (LTR control)</h2>
<p class="ltr">This English paragraph is the LTR control case. It also exercises French accents:
voilà, déjà, château, élève — all within Windows-1252. Numbers: 1,234.56 and dates 2026-06-21.</p>

<div class="box rtl">سطر يحوي <span class="ltr" style="unicode-bidi:isolate">English phrase</span> ثم يكمل بالعربية بعد العبارة الإنجليزية.</div>

</body></html>`;

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle' });
await page.pdf({ path: out, format: 'A4', printBackground: true });
await browser.close();
console.log('wrote', out);
