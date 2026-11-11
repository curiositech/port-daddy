# money: accept thousands separators in parse_amount

Operators paste amounts such as `1,250.50` from spreadsheets, and `parse_amount` refused them. It now accepts commas that group the whole part in threes and refuses a comma anywhere else. Amounts without commas parse as before.
