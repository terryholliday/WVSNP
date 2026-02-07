import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <h1 className="text-2xl font-bold text-gray-900">
                  West Virginia Spay/Neuter Voucher Program
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  Helping West Virginia families care for their pets
                </p>
              </div>
            </div>
            <div className="hidden md:block">
              <div className="text-sm text-gray-600">
                <p>Need help? Call WVDA: (304) 123-4567</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Apply for Spay/Neuter Assistance
          </h2>
          <p className="text-xl text-gray-600 mb-8">
            Get financial help for spaying or neutering your dog or cat
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
            <div className="flex items-center justify-center mb-4">
              <svg className="h-12 w-12 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-blue-900 mb-2">Important Notice</h3>
            <p className="text-blue-800">
              This program is for West Virginia residents only. You must meet income eligibility requirements and have pets that need spay/neuter services.
            </p>
          </div>
        </div>

        {/* Three Main Actions */}
        <div className="grid md:grid-cols-2 gap-8 mb-12">
          {/* Apply for Voucher */}
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="bg-green-100 rounded-full p-4">
                <svg className="h-12 w-12 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-4">Apply for a Voucher</h3>
            <p className="text-gray-600 mb-6">
              Start your application for spay/neuter assistance. Takes about 10-15 minutes.
            </p>
            <Link
              href="/apply/eligibility"
              className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
            >
              Start Application
              <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 111.414-1.414L14.414 11H3a1 1 0 110-2h11.414l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </Link>
          </div>

          {/* Check Status */}
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="bg-blue-100 rounded-full p-4">
                <svg className="h-12 w-12 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-4">Check Application Status</h3>
            <p className="text-gray-600 mb-6">
              Track your application progress and get updates on your voucher status.
            </p>
            <Link
              href="/status"
              className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              Check Status
              <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 111.414-1.414L14.414 11H3a1 1 0 110-2h11.414l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Footer Information */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-2">Eligibility Requirements</h4>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Must be a West Virginia resident</li>
                <li>• Must meet income guidelines</li>
                <li>• Animals must be 4+ months old</li>
                <li>• Animals must not be already spayed/neutered</li>
                <li>• Must use a participating veterinarian</li>
              </ul>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-2">Need Help?</h4>
              <div className="text-sm text-gray-600 space-y-1">
                <p>Call WVDA Helpline: <span className="font-medium">(304) 123-4567</span></p>
                <p>Email: <span className="font-medium">wvda-spayneuter@wv.gov</span></p>
                <p>Hours: Monday-Friday, 9 AM - 5 PM EST</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-gray-50 border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center text-sm text-gray-600">
            <p>© 2026 West Virginia Department of Agriculture. West Virginia Spay/Neuter Voucher Program.</p>
            <p className="mt-2">
              This program is funded by grant funds and matching contributions.
              Eligibility and availability may vary.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
