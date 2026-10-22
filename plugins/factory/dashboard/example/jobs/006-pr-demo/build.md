STATUS: READY

# Build: Search filter by date

## Round 2
- 4340475278 (filter ignores user timezone): fixed. Range is converted from the user's timezone before the query.

## Round 3
- 4341165803 (null end date): fixed. An open-ended range now means "until now".
