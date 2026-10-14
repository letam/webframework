"""Practice-only instance configuration closes unsafe origin and proxy gaps."""

from config.realtime import validate_realtime
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase


class PracticeConfigurationTests(SimpleTestCase):
    """Validate practice when public presence remains disabled."""

    def configuration(self):
        """Start with a complete, explicit practice-only test instance."""
        result = {
            name: getattr(settings, name)
            for name in dir(settings)
            if name.startswith(('REALTIME_', 'PRESENCE_', 'PRACTICE_'))
        }
        result.update(
            DEBUG=True,
            REALTIME_ENABLED=True,
            PRESENCE_ENABLED=False,
            PRACTICE_ENABLED=True,
            PRACTICE_ORIGINS=['http://localhost:5173'],
            REALTIME_REDIS_URL='redis://127.0.0.1:6379/0',
            REALTIME_PREFIX='practice-test',
        )
        return result

    def test_practice_only_still_validates_trusted_proxy(self):
        """Unsafe proxy trust cannot bypass socket limits on a practice-only site."""
        config = self.configuration()
        for networks in (['0.0.0.0/0'], ['not-a-network']):
            with self.subTest(networks=networks):
                config['PRESENCE_TRUSTED_PROXY_NETWORKS'] = networks
                with self.assertRaises(ImproperlyConfigured):
                    validate_realtime(config)
        config['PRESENCE_TRUSTED_PROXY_NETWORKS'] = []
        config['PRESENCE_PROXY_IP_HEADER'] = 'x-forwarded-for'
        with self.assertRaises(ImproperlyConfigured):
            validate_realtime(config)

    def test_practice_origin_is_exact_and_secure_in_production(self):
        """A room socket origin cannot be wild, missing or HTTP in production."""
        config = self.configuration()
        config['DEBUG'] = False
        for origin in ('*', 'http://app.example', 'https://*.example', 'https://app.example/x'):
            with self.subTest(origin=origin):
                config['PRACTICE_ORIGINS'] = [origin]
                with self.assertRaises(ImproperlyConfigured):
                    validate_realtime(config)
