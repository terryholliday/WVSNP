'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/forms/button';
import { apiClient } from '@/lib/api-client';
import { generateReferenceCode } from '@/lib/reference-code';
import { offlineStore } from '@/lib/offline-store';

interface ApplicantForm {
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  email: string;
  phone: string;
  preferredContact: 'email' | 'phone' | 'mail';
}

export default function ApplicantPage() {
  const [form, setForm] = useState<ApplicantForm>({
    firstName: '',
    lastName: '',
    addressLine1: '',
    city: '',
    state: 'WV',
    zipCode: '',
    email: '',
    phone: '',
    preferredContact: 'email',
    addressLine2: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');

  // Generate a temporary application ID for offline storage
  const applicationId = 'temp-' + crypto.randomUUID();

  // Load saved data on component mount
  useEffect(() => {
    const loadSavedData = async () => {
      try {
        if (OfflineStore.isAvailable()) {
          await offlineStore.init();
          const saved = await offlineStore.loadApplication(applicationId);
          if (saved && saved.step === 'applicant') {
            setForm(saved.data);
          }
        }
      } catch (error) {
        console.warn('Failed to load saved application data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSavedData();
  }, [applicationId]);

  // Auto-save form data
  useEffect(() => {
    const autoSave = async () => {
      try {
        if (OfflineStore.isAvailable() && !isLoading) {
          await offlineStore.saveApplication(applicationId, '', form, 'applicant');
        }
      } catch (error) {
        console.warn('Failed to auto-save form data:', error);
      }
    };

    // Debounce auto-save
    const timeoutId = setTimeout(autoSave, 1000);
    return () => clearTimeout(timeoutId);
  }, [form, applicationId, isLoading]);

  const handleInputChange = (field: keyof ApplicantForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError(''); // Clear error when user starts typing
  };

  const isFormValid = () => {
    return (
      form.firstName.trim().length > 0 &&
      form.lastName.trim().length > 0 &&
      form.addressLine1.trim().length > 0 &&
      form.city.trim().length > 0 &&
      form.state === 'WV' &&
      /^\d{5}(-\d{4})?$/.test(form.zipCode) &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) &&
      (form.phone.length === 0 || /^\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/.test(form.phone))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      // Save to API and offline store (Phase 2: API Integration)

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Navigate to next step
      window.location.href = '/apply/animals';
    } catch (error) {
      console.error('Error saving applicant info:', error);
      setError('Unable to save your information. Your data has been saved locally. Please check your internet connection and try again.');
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your saved information...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link href="/apply/eligibility" className="flex items-center">
                <svg className="h-8 w-8 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="text-lg font-semibold text-gray-900">Back to Eligibility</span>
              </Link>
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium">Step 2 of 6:</span> Your Information
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Tell Us About Yourself
            </h1>
            <p className="text-lg text-gray-600">
              We need your contact information to process your application and send you updates about your voucher.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Name Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                label="First Name"
                name="firstName"
                required
              >
                <input
                  type="text"
                  value={form.firstName}
                  onChange={(e) => handleInputChange('firstName', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="John"
                />
              </FormField>

              <FormField
                label="Last Name"
                name="lastName"
                required
              >
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => handleInputChange('lastName', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Doe"
                />
              </FormField>
            </div>

            {/* Address Fields */}
            <FormField
              label="Street Address"
              name="addressLine1"
              required
              hint="Your mailing address where you receive mail"
            >
              <input
                type="text"
                value={form.addressLine1}
                onChange={(e) => handleInputChange('addressLine1', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="123 Main Street"
              />
            </FormField>

            <FormField
              label="Address Line 2 (Optional)"
              name="addressLine2"
              hint="Apartment, suite, unit, building, floor, etc."
            >
              <input
                type="text"
                value={form.addressLine2}
                onChange={(e) => handleInputChange('addressLine2', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Apt 4B"
              />
            </FormField>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                label="City"
                name="city"
                required
              >
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => handleInputChange('city', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Charleston"
                />
              </FormField>

              <FormField
                label="State"
                name="state"
                required
              >
                <select
                  value={form.state}
                  onChange={(e) => handleInputChange('state', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  disabled
                >
                  <option value="WV">West Virginia</option>
                </select>
              </FormField>

              <FormField
                label="ZIP Code"
                name="zipCode"
                required
                hint="5 digits or ZIP+4"
              >
                <input
                  type="text"
                  value={form.zipCode}
                  onChange={(e) => handleInputChange('zipCode', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="25301"
                  pattern="\d{5}(-\d{4})?"
                  maxLength={10}
                />
              </FormField>
            </div>

            {/* Contact Information */}
            <FormField
              label="Email Address"
              name="email"
              required
              hint="We'll send your application confirmation and voucher details here"
            >
              <input
                type="email"
                value={form.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="john.doe@example.com"
              />
            </FormField>

            <FormField
              label="Phone Number (Optional)"
              name="phone"
              hint="For urgent updates about your voucher or application status"
            >
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="(304) 555-0123"
              />
            </FormField>

            {/* Preferred Contact Method */}
            <FormField
              label="Preferred Contact Method"
              name="preferredContact"
              required
              hint="How would you prefer to receive updates about your application?"
            >
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="preferredContact"
                    value="email"
                    checked={form.preferredContact === 'email'}
                    onChange={(e) => handleInputChange('preferredContact', e.target.value as 'email')}
                    className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-gray-700">Email (recommended for fastest updates)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="preferredContact"
                    value="phone"
                    checked={form.preferredContact === 'phone'}
                    onChange={(e) => handleInputChange('preferredContact', e.target.value as 'phone')}
                    className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-gray-700">Phone (text messages for updates)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="preferredContact"
                    value="mail"
                    checked={form.preferredContact === 'mail'}
                    onChange={(e) => handleInputChange('preferredContact', e.target.value as 'mail')}
                    className="focus:ring-blue-500 h-4 w-4 text-blue-600 border-gray-300"
                  />
                  <span className="ml-2 text-sm text-gray-700">Mail (physical letters)</span>
                </label>
              </div>
            </FormField>

            {/* Navigation */}
            <div className="flex justify-between pt-6 border-t border-gray-200">
              <Link href="/apply/eligibility">
                <Button variant="outline" type="button">
                  <svg className="mr-2 -ml-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Back
                </Button>
              </Link>

              <Button
                type="submit"
                disabled={!isFormValid() || isSubmitting}
                loading={isSubmitting}
              >
                Continue to Animals
                <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 111.414-1.414L14.414 11H3a1 1 0 110-2h11.414l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </Button>
            </div>
          </form>

          {/* Progress Indicator */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Step 2 of 6</span>
              <span>Your information is saved automatically</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
