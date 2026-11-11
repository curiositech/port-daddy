# Work order: probability estimates for the audit desk

The audit desk is drawing up next quarter's audit plan. It wants your estimates for six situations on the lanes. `questions.md` in this directory describes the situations and then lists 33 questions about them.

## What to do

Each question makes one statement about a situation. Give the probability that the statement is true, as a number between 0 and 1.

The situations are described in words and leave a good deal open. Where a figure is not given, use your own judgment and give your best estimate.

Write your estimates to `estimates.json` in this directory. It must be one JSON object with a key for every question number in `questions.md`, each with a number between 0 and 1 as its value:

    {"1": <probability>, "2": <probability>, ...}

When the file is written, reply with one line saying it is done.
