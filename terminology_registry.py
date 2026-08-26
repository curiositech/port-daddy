class TerminologyRegistry:
    def __init__(self):
        self.register = {}
    def update(self, old_term, new_term):
        self.register[old_term] = new_term