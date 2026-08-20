# Takedown and Data Removal

This project indexes **business listings only**. It does not collect residential
numbers or personal data.

If you are a business owner (or their authorised representative) and want your
listing removed from `directory.pooyagolchian.com`, we will remove it. You do not
need to explain why.

## How to request removal

**Email:** hello@pooyagolchian.com with the subject line `TAKEDOWN`

Include either:

- the URL of the page on `directory.pooyagolchian.com`, **or**
- the business name and phone number as they appear on the listing

## What happens next

| Step                                                      | Timeline               |
| --------------------------------------------------------- | ---------------------- |
| We acknowledge your request                               | within 3 business days |
| The listing is removed from the live site                 | within 7 business days |
| The `place_id` is added to the permanent suppression list | same day as removal    |

Suppressed records are added to `data/suppression-list.json`, which the pipeline
reads on **every** run. This means a removed business **stays** removed — it will
not reappear after the next crawl. That file contains only opaque Google
`place_id` values, never names, phone numbers, or addresses.

## Source data

Business information here originates from Google Maps, retrieved via the
[SearchApi](https://www.searchapi.io/) Google Maps engine. Removing a listing
from this directory does **not** remove it from Google. To correct or remove the
underlying Google listing, use
[Google Business Profile](https://support.google.com/business/answer/3039617).

## Reporting inaccurate data

Wrong phone number, wrong category, closed business? Open a
[GitHub issue](https://github.com/pooyagolchian/directory-from-scratch/issues)
or email the address above. Category mistakes can also be fixed directly by
pull request against `data/taxonomy-map.json`.
