'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function StatusPage() {
  const [referenceCode, setReferenceCode] = useState('');
  const [email, setEmail] = useState('');
  const [application, setApplication] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLookup = async () => {
    if (!referenceCode || !email) {
      setError('Please enter both reference code and email');
      return;
    }

    setLoading(true);
    setError('');
    
    // Simulate API call - will connect to real API in production
    setTimeout(() => {
      setApplication({
        referenceCode: referenceCode,
        organizationName: 'Greenbrier Humane Society',
        status: 'UNDER_REVIEW',
        submittedDate: '2026-01-15',
        lastUpdated: '2026-02-01',
        reviewNotes: 'Application is currently under review by WVDA grant committee. Expected decision by February 28, 2026.'
      });
      setLoading(false);
    }, 1000);
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { bg: string; text: string; label: string }> = {
      SUBMITTED: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Submitted' },
      UNDER_REVIEW: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Under Review' },
      APPROVED: { bg: 'bg-green-100', text: 'text-green-800', label: 'Approved' },
      DENIED: { bg: 'bg-red-100', text: 'text-red-800', label: 'Denied' },
      MORE_INFO_NEEDED: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'More Info Needed' }
    };

    const badge = badges[status] || badges.SUBMITTED;
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <Link href="/" className="flex items-center text-blue-600 hover:text-blue-800">
              <svg className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Home
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            Check Application Status
          </h1>

          {!application ? (
            <div className="space-y-6">
              <p className="text-gray-600">
                Enter your application reference code and email to check the status of your grant application.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Application Reference Code
                </label>
                <input
                  type="text"
                  value={referenceCode}
                  onChange={(e) => setReferenceCode(e.target.value.toUpperCase())}
                  placeholder="WVSNP-XXXX-XXXX"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="contact@organization.org"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                  {error}
                </div>
              )}

              <button
                onClick={handleLookup}
                disabled={loading}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Looking up...' : 'Check Status'}
              </button>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-6">
                <h3 className="font-semibold text-gray-900 mb-2">Don't have your reference code?</h3>
                <p className="text-sm text-gray-600">
                  Your reference code was sent to your email when you submitted your application. 
                  Check your inbox for an email from WVDA Grant Administration.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-gray-200">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">{application.organizationName}</h2>
                  <p className="text-sm text-gray-600">Reference: {application.referenceCode}</p>
                </div>
                {getStatusBadge(application.status)}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-700">Submitted</p>
                  <p className="text-gray-900">{new Date(application.submittedDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">Last Updated</p>
                  <p className="text-gray-900">{new Date(application.lastUpdated).toLocaleDateString()}</p>
                </div>
              </div>

              {application.reviewNotes && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-semibold text-blue-900 mb-2">Status Notes</h3>
                  <p className="text-sm text-blue-800">{application.reviewNotes}</p>
                </div>
              )}

              {application.status === 'APPROVED' && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="font-semibold text-green-900 mb-2">Next Steps</h3>
                  <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
                    <li>Review your grant agreement (sent via email)</li>
                    <li>Complete required training</li>
                    <li>Set up reporting access</li>
                    <li>Begin coordinating with veterinary partners</li>
                  </ul>
                </div>
              )}

              <button
                onClick={() => {
                  setApplication(null);
                  setReferenceCode('');
                  setEmail('');
                }}
                className="w-full px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Check Another Application
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
