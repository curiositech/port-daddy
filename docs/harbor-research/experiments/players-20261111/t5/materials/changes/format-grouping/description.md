# money: format amounts with thousands separators on request

Reports print large amounts, and `1250000.00` is hard to read. `format_amount(cents, grouping=True)` separates thousands with commas. The default output is unchanged, so nothing that parses it breaks.
