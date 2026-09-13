#--------------------------------------------------------------------------------
# Constants used in RC Bridge (a fork of AbletonOSC - see README.md)
#
# RC Bridge listens on its own port so that it can run beside a stock
# AbletonOSC (11000) without either one failing to bind. Replies go back to
# whichever socket asked, so OSC_RESPONSE_PORT only names the default target
# for unsolicited messages (/live/error) before anybody has asked anything.
#--------------------------------------------------------------------------------

OSC_LISTEN_PORT = 11020
OSC_RESPONSE_PORT = 11021

RCBRIDGE_NAME = "RC Bridge"
RCBRIDGE_VERSION = "1.0.0"
RCBRIDGE_UPSTREAM = "ideoforms/AbletonOSC@0ca6821"

