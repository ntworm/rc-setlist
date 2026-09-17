"""RC Bridge protocol layer: OSC surface for Ableton Live."""

try:
    from .manager import Manager
except ImportError:
    # This is needed for unit tests to work through pytest.
    # Otherwise, pytest will attempt and fail to import this __init__.py
    pass


def create_instance(c_instance):
    """Live's Remote Script factory entry point; returns the Manager."""
    return Manager(c_instance)
