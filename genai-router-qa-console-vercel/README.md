# GenAI Router QA Console v1.1

כלי QA ל-Router API 1.0.6.

## מה נוסף ב-v1.1
- Readiness checklist: TSH URL, Bearer Token, App ID, User ID, Case ID.
- כפתור להעתקת 3 השאלות הקריטיות לצוות הפיתוח.
- מסך פערי API Contract מרכזיים.
- חלון פרטי Test Case ואפשרות לסמן בדיקה ידנית PASS / FAIL / BLOCKED / QUESTION עם הערה.
- SSE Inspector שמפרק אירועים ומסמן `thought` לבדיקה מיוחדת של דליפת reasoning.
- Proxy מוקשח: רק 23 הפעולות שב-Swagger, HTTPS בלבד, חסימת localhost/private IP, timeout ומגבלת payload.
- Token נשאר בזיכרון הדפדפן בלבד ואינו נכלל בדוחות.

## לפני הרצה אמיתית
נדרשים: TSH Base URL, Bearer Token תקין, App ID, User ID, Case ID.

## הערת רשת
אם סביבת TSH נגישה רק מתוך VPN/רשת פנימית, Vercel ציבורי לא יוכל להגיע אליה. במקרה כזה יש להריץ את הכלי מקומית/מתוך הרשת או להגדיר קישוריות מאושרת.
