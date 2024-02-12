// controllers/authController.js

const crypto = require('crypto');
const { promisify } = require('util');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const sendEmail = require('./../utils/email');
const {
  nodeEnv,
  jwtSecret,
  jwtExpiresIn,
  jwtCookieExpiresIn
} = require('../config/vars');
const dataAccess = require('../utils/dataAccess');

const userModel = 'User';

/**
 * @returns a JSON Web Token (JWT) that is signed with the provided `id` and `JWT_SECRET`.
 * The token will expire after the duration specified in `JWT_EXPIRES_IN`.
 */
const signToken = id => {
  return jwt.sign({ id }, jwtSecret, {
    expiresIn: jwtExpiresIn
  });
};

/**
 * Create and send a token to the client, set a cookie with the token, and send a JSON response.
 * @param user - User object with user information.
 * @param statusCode - HTTP status code for the response.
 * @param res - Response object to send the response.
 */
const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  const cookieOptions = {
    expires: new Date(Date.now() + jwtCookieExpiresIn * 24 * 60 * 60 * 1000),
    httpOnly: true
  };

  if (nodeEnv === 'production') cookieOptions.secure = true;

  res.cookie('jwt', token, cookieOptions);

  // Remove password from output
  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user
    }
  });
};

/* handles the signup functionality for a user*/
exports.signup = catchAsync(async (req, res, next) => {
  const newUser = await dataAccess.create(userModel, {
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm
  });

  createSendToken(newUser, 201, res);
});

/* Handles the login functionality for a user.*/
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // 1) Check if email and password exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password!', 400));
  }
  // 2) Check if user exists && password is correct
  const user = await dataAccess.findByEmail(userModel, email);

  // Check if user was found and the password is available for comparison
  if (!user || !user.password) {
    return next(new AppError('Incorrect email or password', 401));
  }

  // Now safely compare the passwords
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return next(new AppError('Incorrect email or password', 401));
  }

  // 3) If everything ok, send token to client
  createSendToken(user, 200, res);
});


exports.logout = (req, res) => {
  res.cookie('jwt', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });
  res.status(200).json({ status: 'success' });
};

/* Middleware function that is used to protect routes from unauthorized access.
 It checks if the user is logged in by verifying the JSON Web Token (JWT)
 provided in the request header. */
exports.protect = catchAsync(async (req, res, next) => {
  // 1) Getting token and check of it's there
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(
      new AppError('You are not logged in! Please log in to get access.', 401)
    );
  }

  // 2) Verification token
  const decoded = await promisify(jwt.verify)(token, jwtSecret);

  // 3) Check if user still exists
  const currentUser = await dataAccess.findById(userModel,decoded.id);
  if (!currentUser) {
    return next(
      new AppError(
        'The user belonging to this token does no longer exist.',
        401
      )
    );
  }

  // 4) Check if user changed password after the token was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please log in again.', 401)
    );
  }

  // GRANT ACCESS TO PROTECTED ROUTE
  req.user = currentUser;
  next();
});


exports.conditionalProtect = catchAsync(async (req, res, next) => {
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    const token = req.headers.authorization.split(' ')[1];

    try {
      // Verify the token
      const decoded = await promisify(jwt.verify)(token, jwtSecret);

      // Check if user still exists
      const currentUser = await dataAccess.findById(userModel,decoded.id);
      req.user = currentUser ? currentUser : null;
    } catch (err) {
      // Catch any JWT related errors here (like malformed JWT)
      req.user = null;
    }
  }

  // Proceed to the next middleware
  next();
});

// Only for rendered pages, no errors!
exports.isLoggedIn = async (req, res, next) => {
  if (req.cookies.jwt) {
    try {
      // 1) verify token
      const decoded = await promisify(jwt.verify)(req.cookies.jwt, jwtSecret);

      // 2) Check if user still exists
      const currentUser = await dataAccess.findById(userModel,decoded.id);
      if (!currentUser) {
        return next();
      }

      // 3) Check if user changed password after the token was issued
      if (currentUser.changedPasswordAfter(decoded.iat)) {
        return next();
      }

      // THERE IS A LOGGED IN USER
      res.locals.user = currentUser;
      return next();
    } catch (err) {
      return next();
    }
  }
  next();
};

/* Middleware function that restricts access to certain routes based on the user's role.
 It takes in an array of roles as arguments and returns another middleware
 function that checks if the user's role is included in the provided roles array.
 If the user's role is not included, it returns an error message indicating that the user
 does not have permission to perform the action. If the user's role is included,
 it calls the `next()` function to proceed to the next middleware or route handler. */

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    // roles ['admin', 'lead-guide']. role='user'
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }

    next();
  };
};

/* Handles the logic for the "Forgot Password" feature. */
////////////
exports.forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;
  try {
      // Generate and save the password reset token using the DataAccess method
      const resetToken = await dataAccess.generatePasswordResetToken(email);

      // Construct the reset URL
      const resetURL = `${req.protocol}://${req.get('host')}/api/v1/users/resetPassword/${resetToken}`;

      // Email content
      const message = `Forgot your password? Submit a PATCH request with your new password and passwordConfirm to: ${resetURL}.\nIf you didn't forget your password, please ignore this email!`;

      // Attempt to send the email
      await sendEmail({
          email,
          subject: 'Your password reset token (valid for 10 min)',
          message
      });

      // Respond with success message
      res.status(200).json({
          status: 'success',
          message: 'Token sent to email!'
      });
  } catch (err) {
      // If an error occurs, reset any modifications to avoid saving partial state
      return next(new AppError('There was an error sending the email. Try again later!', 500));
  }
});
;

/* Handles the logic for resetting a user's password. */

exports.resetPassword = catchAsync(async (req, res, next) => {
  // Assuming the token is sent via URL params and the new password in the body
  const { token } = req.params;
  const { password } = req.body;

  // Hash the token as done before to find the user
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  // Use a DataAccess method to reset the password
  const user = await dataAccess.resetUserPasswordByEmailAndToken(hashedToken, password);
  
  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }
  // Log the user in, send JWT
  createSendToken(user, 200, res);
});


/* Handles the logic for updating a user's password. */

exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1) Get user from collection
  const user = await dataAccess.findById(userModel,req.user.id);

  // 2) Check if POSTed current password is correct
  if (!(await dataAccess.comparePassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is wrong.', 401));
  }

  // 3) If so, update password
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();//////////////////////////

  // 4) Log user in, send JWT
  createSendToken(user, 200, res);
});
