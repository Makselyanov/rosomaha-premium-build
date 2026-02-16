PATCH: Beautiful Article Template System
=====================================

This patch introduces a unified, responsive CSS framework for article pages (/articles and /articles/*) 
with professional typography, no horizontal scrolling, and mobile-first design.

---

## FILES CHANGED:

### 1. NEW FILE: src/assets/css/articles.css
   - Complete responsive typography system (clamp-based font scaling)
   - Container max-width: 860px with adaptive padding
   - Line-height 1.7-1.8 for optimal readability
   - All element styles: headings, paragraphs, lists, blockquotes, code, tables, images
   - Proper overflow handling (overflow-wrap: anywhere, white-space: pre-wrap)
   - No horizontal scrolling at any breakpoint (tested 320px+)
   - Mobile-first responsive adjustments
   - Print styles included

### 2. UPDATED: src/pages/ArticleDetailPage.tsx
   - Added import: `import '@/assets/css/articles.css';`
   - Changed main content wrapper from `<div className="container"><div className="max-w-4xl mx-auto"><article className="prose prose-invert max-w-none break-words">`
     to: `<div className="article-container"><article className="article-content">`
   - Changed related articles section container from `<div className="container">` to `<div className="article-container">`
   - Changed CTA section container from `<div className="container"><div className="max-w-3xl mx-auto text-center">` 
     to: `<div className="article-container text-center">`
   - Removed inline `prose` and `prose-invert` classes in favor of dedicated `article-content` class

### 3. UPDATED: src/pages/ArticlesPage.tsx
   - Added import: `import '@/assets/css/articles.css';`
   - (Future use - maintains consistency across article-related pages)

---

## KEY FEATURES:

✅ Responsive Typography
   - h1: clamp(1.8rem, 6vw, 2.5rem)
   - h2: clamp(1.4rem, 5vw, 1.875rem)
   - p: clamp(0.95rem, 2.5vw, 1.1rem)
   - Auto-scales between mobile (320px) and desktop (1440px+)

✅ Container & Spacing
   - max-width: 860px (optimal reading width)
   - Padding: clamp(1rem, 5vw, 3rem)
   - Consistent margins between elements using clamp()

✅ Typography Settings
   - line-height: 1.8 (great readability)
   - Proper margin-bottom between paragraphs (1rem to 1.5rem)
   - Heading margins carefully balanced
   - Consistent hyphens: auto for text

✅ Element Styles
   - Links: border-bottom + hover color + padding
   - Lists: proper nesting support, clear hierarchy
   - Blockquotes: colored border-left, subtle background
   - Code blocks: no horizontal scroll (pre-wrap + word-break)
   - Tables: scrollable wrapper, hover effects
   - Images: rounded, bordered, responsive
   - HR, DL/DT/DD: all styled

✅ Mobile Safety (320px)
   - NO horizontal overflow at any size
   - Pre: white-space: pre-wrap; word-break: break-word; overflow-x: hidden
   - overflow-wrap: break-word on all text elements
   - Special media queries for 320-360px screens
   - Adaptive font sizing for all breakpoints

✅ Code Block Protection
   - white-space: pre-wrap
   - word-break: break-word
   - overflow-x: hidden
   - Prevents long code lines from breaking layout

---

## USAGE:

1. Import the CSS (already done in ArticleDetailPage.tsx and ArticlesPage.tsx)
2. Wrap article content with: `<div className="article-container"><article className="article-content">...</article></div>`
3. Use standard HTML/Markdown elements - they're automatically styled
4. ReactMarkdown will automatically apply these styles to article.content

---

## TESTING CHECKLIST:

✓ Desktop (1440px): Full width container centered, optimal spacing
✓ Tablet (768px): Responsive scaling, proper padding
✓ Mobile (480px): Comfortable reading, clear hierarchy
✓ Small mobile (360px): No overflow, readable text
✓ Extra small (320px): All content accessible, no horizontal scroll
✓ Code blocks: Test with long lines - should wrap, not scroll
✓ Tables: Should be responsive, not break layout
✓ Images: Should scale responsively
✓ Links: Proper hover states and styling
✓ Dark mode: All colors should work with CSS variables

---

## GIT COMMANDS TO APPLY:

git add src/assets/css/articles.css
git add src/pages/ArticleDetailPage.tsx
git add src/pages/ArticlesPage.tsx
git commit -m "feat: add unified beautiful article template system with responsive typography"
git push

---

## CSS VARIABLES USED:

--primary: Primary brand color
--secondary: Secondary background color
--border: Border color
--background: Page background
--foreground: Text color
--muted-foreground: Dimmed text
--card: Card background
--primary-foreground: Text on primary

All defined in your existing design system / Tailwind config.
