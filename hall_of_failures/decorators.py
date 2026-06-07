import functools

def register_handler(event_type):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            print(f"Handling event: {event_type}")
            return func(*args, **kwargs)
        # Dynamic property assignment that CGE parser might miss
        wrapper.is_handler = True
        wrapper.handled_event = event_type
        return wrapper
    return decorator

class EventSystem:
    @register_handler("user_login")
    def on_login(self, user_id):
        pass
        
    @register_handler("data_sync")
    def on_sync(self, payload):
        pass
