type: added

- **Chapter 2 now builds a card that can be taken back.** A card used to be good until the time it said. A new section has the gate keep a record of cards taken back, and breaks it twice on the way: a gate that looks up only the card it is shown still honours the cards handed on under it, and a record that forgets by age lets a card back in. The fix looks up every card of a chain and keeps an entry as long as its card lasts. The code and output are cut from the Book's own kernel.
