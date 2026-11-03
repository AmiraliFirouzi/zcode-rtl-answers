---
name: rtl-answers
description: Render assistant answers written in RTL languages (Persian/Farsi, Arabic, Hebrew, Urdu, Kurdish, Pashto) as a right-to-left inline panel with the render_rtl tool. Use for every Persian or other RTL-language response longer than a couple of sentences, because chat text renders left-to-right and becomes unreadable. / پاسخ‌های فارسی را راست‌چین و خوانا در پنل نمایش بده.
---

# RTL Answers — پاسخ راست‌چین

متن چت ZCode همیشه LTR رندر می‌شود و فارسی به‌هم می‌ریزد. قرارداد کامل روی خود ابزار `render_rtl` هست؛ خلاصه:

1. کل پاسخ را markdown خام در `text` بده (کد در fence). `dir` = پوشه‌ی visualization نشست جاری از context محیط. `title` کوتاه (فایل ASCII می‌سازد). `lang` پیش‌فرض `fa`.
2. خط `::visualize{...}` برگشتی را **عیناً** در آخرین خط پیام نهایی بنویس (نه در بلاک کد).
3. در چت فقط ۱–۲ جمله جمع‌بندی فارسی؛ بدنه‌ی پاسخ در پنل.

فالبک بدون ابزار: fragment بساز با ریشه `<div dir="rtl" style="direction:rtl;text-align:right;font-family:Vazirmatn,Tahoma,sans-serif;">`، فونت Vazirmatn از fonts.googleapis.com، کد در `<pre><code dir="ltr">`، و نام فایل فقط حروف کوچک انگلیسی/عدد/خط‌تیره (اعتبارسنج اپ نام فارسی را رد می‌کند). در انتها `::visualize{"path":"<abs-path>"}`.
