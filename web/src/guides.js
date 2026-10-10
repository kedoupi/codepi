export const guides = [
  {
    slug: 'how-monthly-mortgage-payments-are-calculated',
    title: 'How monthly mortgage payments are calculated',
    description: 'A plain-English walkthrough of the fully amortizing loan formula, with a static $400,000 example you can check by hand.',
    href: '/guides/how-monthly-mortgage-payments-are-calculated/',
    toolHref: '/mortgage-calculator/',
    toolLabel: 'Open the mortgage calculator',
  },
  {
    slug: 'how-to-read-take-home-pay',
    title: 'How to read take-home pay and paycheck withholding',
    description: 'What usually comes out of a US paycheck: federal income tax, FICA, state tax, and pretax deductions — plus a worked $72,000 example.',
    href: '/guides/how-to-read-take-home-pay/',
    toolHref: '/paycheck-calculator/',
    toolLabel: 'Open the paycheck calculator',
  },
  {
    slug: 'how-us-federal-income-tax-brackets-work',
    title: 'How US federal income tax brackets work',
    description: 'Why the US system is progressive, not flat, and how to compute tax one bracket at a time using 2026 IRS figures.',
    href: '/guides/how-us-federal-income-tax-brackets-work/',
    toolHref: '/income-tax-calculator/',
    toolLabel: 'Open the income tax calculator',
  },
];

export function getGuide(slug) {
  return guides.find((guide) => guide.slug === slug);
}
